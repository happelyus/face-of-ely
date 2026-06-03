const MONDAY_API_URL = 'https://api.monday.com/v2';

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

export async function boardIdHandler(req, res) {
  const urlId = req.query.url_id;

  if (!urlId) {
    return res.status(400).json({ error: 'url_id query parameter is required' });
  }

  try {
    const query = `
      query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          name
        }
      }
    `;
    const data = await mondayQuery(query, { boardId: String(urlId) });
    const board = data.boards?.[0];

    if (!board) {
      return res.status(404).json({ error: `No board found for url_id: ${urlId}` });
    }

    const apiId = String(board.id);
    const currentIds = process.env.ATTRIBUTE_LIBRARY_BOARD_IDS
      .split(',')
      .map(id => id.trim());
    const inConfig = currentIds.includes(apiId);

    return res.json({
      url_id: urlId,
      api_id: apiId,
      board_name: board.name,
      in_config: inConfig,
      add_to_config: inConfig ? null : apiId,
      current_config: currentIds,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}