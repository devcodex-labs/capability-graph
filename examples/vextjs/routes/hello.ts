import { defineRoutes } from 'vextjs';

export default defineRoutes(app => {
  app.post('/hello', {
    validate: { body: { name: 'string:1-30' } },
    docs: { summary: 'Create a validated greeting' },
  }, async (req, res) => {
    const body = req.valid('body') as { name: string };
    res.json({ greeting: `Hello, ${body.name}` });
  });
});
