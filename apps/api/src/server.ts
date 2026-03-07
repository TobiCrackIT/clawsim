import { createApp } from './index.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`API listening on :${port}`);
});
