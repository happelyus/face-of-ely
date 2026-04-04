import 'dotenv/config';
import express from 'express';
import { skuWebhookHandler } from './webhooks/sku.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/webhook/sku', skuWebhookHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`face-of-ely running on port ${PORT}`));