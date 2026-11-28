// Stand-in for the Supabase Storage API used only by the backup drill (fictional files).
import http from "node:http";

const KEY = process.env.MOCK_KEY ?? "drill-service-key";
const tree = {
  "": [
    { name: "merchant-1", id: null },
    { name: "readme.txt", id: "a" },
  ],
  "merchant-1": [{ name: "licence.pdf", id: "b" }],
};
http
  .createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401);
      return res.end();
    }
    if (req.method === "POST" && req.url === "/storage/v1/object/list/drill") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { prefix } = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(tree[prefix] ?? []));
      });
      return;
    }
    const match = req.url?.match(/^\/storage\/v1\/object\/authenticated\/drill\/(.+)$/);
    if (match) return res.end(`fictional content of ${match[1]}`);
    res.writeHead(404);
    res.end();
  })
  .listen(Number(process.env.MOCK_PORT ?? 54999), "127.0.0.1");
