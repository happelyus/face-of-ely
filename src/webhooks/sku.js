const MONDAY_API_URL = 'https://api.monday.com/v2';
const SKU_CODE_COLUMN_TITLE = process.env.SKU_CODE_COLUMN_TITLE || 'SKU Code';

if (!process.env.MONDAY_API_TOKEN) {
  throw new Error('MONDAY_API_TOKEN environment variable is required');
}
if (!process.env.ATTRIBUTE_LIBRARY_BOARD_IDS) {
  throw new Error('ATTRIBUTE_LIBRARY_BOARD_IDS environment variable is required');
}

const ATTRIBUTE_LIBRARY_BOARD_IDS = process.env.ATTRIBUTE_LIBRARY_BOARD_IDS
  .split(',')
  .map(id => id.trim());

async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_TOKEN,
      'API-Version': '2025-01',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

function deriveColumnRef(title) {
  return title
    .split(' ')
    .map(word => word[0].toUpperCase())
    .join('');
}

function findSkuCodeColumnId(boardColumns) {
  const col = boardColumns.find(
    c => c.title === SKU_CODE_COLUMN_TITLE && c.type === 'text'
  );
  return col?.id ?? null;
}

async function fetchItemData(itemId) {
  const query = `
    query ($itemId: ID!) {
      items(ids: [$itemId]) {
        id
        name
        board {
          id
          columns {
            id
            title
            type
          }
        }
        column_values {
          id
          type
          text
          ... on BoardRelationValue {
            linked_items {
              id
              name
              board {
                id
                name
                columns {
                  id
                  title
                  type
                }
              }
              column_values {
                id
                type
                text
              }
            }
          }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { itemId: String(itemId) });
  return data.items?.[0];
}

function assembleSkuCode(item) {
  const boardColumns = item.board.columns;

  const columnTitleMap = {};
  for (const col of boardColumns) {
    columnTitleMap[col.id] = col.title;
  }

  let productCode = null;
  const attributeSegments = [];

  for (const colValue of item.column_values) {
    if (colValue.type !== 'board_relation') continue;

    const linkedItems = colValue.linked_items;
    if (!linkedItems || linkedItems.length === 0) continue;

    const linkedItem = linkedItems[0];

    const linkedBoardColumnTitleMap = {};
    for (const col of (linkedItem.board?.columns ?? [])) {
      linkedBoardColumnTitleMap[col.id] = col.title;
    }

    const codeField = linkedItem.column_values.find(
      cv => linkedBoardColumnTitleMap[cv.id]?.toLowerCase() === 'code'
    );

    const isAttributeLibraryConnection = ATTRIBUTE_LIBRARY_BOARD_IDS
      .includes(String(linkedItem.board?.id));

    if (!isAttributeLibraryConnection) {
      if (codeField?.text) productCode = codeField.text;
      continue;
    }

    if (!codeField?.text) continue;

    const columnTitle = columnTitleMap[colValue.id] ?? colValue.id;
    const columnRef = deriveColumnRef(columnTitle);
    attributeSegments.push(`${columnRef}_${codeField.text}`);
  }

  if (!productCode) return null;

  return [productCode, ...attributeSegments].join('-');
}

async function writeSkuCode(boardId, itemId, columnId, skuCode) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
      ) {
        id
      }
    }
  `;
  await mondayQuery(mutation, {
    boardId: String(boardId),
    itemId: String(itemId),
    columnId,
    value: JSON.stringify(skuCode),
  });
}

async function updateItemName(boardId, itemId, name) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $name: String!) {
      change_simple_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: "name"
        value: $name
      ) {
        id
        name
      }
    }
  `;
  await mondayQuery(mutation, {
    boardId: String(boardId),
    itemId: String(itemId),
    name,
  });
}

export async function skuWebhookHandler(req, res) {
  const body = req.body;

  if (body.challenge) {
    return res.json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event) return res.sendStatus(400);

  const { pulseId: itemId, boardId, columnId } = event;

  res.sendStatus(200);

  try {
    const item = await fetchItemData(itemId);
    if (!item) return;

    const skuCodeColumnId = findSkuCodeColumnId(item.board.columns);
    if (!skuCodeColumnId) {
      console.log(`Item ${itemId}: no "${SKU_CODE_COLUMN_TITLE}" column found on board ${boardId}`);
      return;
    }

    if (columnId === skuCodeColumnId) return;

    const skuCode = assembleSkuCode(item);
    if (!skuCode) {
      console.log(`Item ${itemId}: no product linked, skipping`);
      return;
    }

    await writeSkuCode(boardId, itemId, skuCodeColumnId, skuCode);
    console.log(`Item ${itemId}: SKU written → ${skuCode}`);

    await updateItemName(boardId, itemId, skuCode);
    console.log(`Item ${itemId}: name updated → ${skuCode}`);

  } catch (err) {
    console.error(`Error processing item ${itemId}:`, err.message);
  }
}