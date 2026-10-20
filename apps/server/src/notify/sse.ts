import type { Request, Response } from "express";

/** Server-Sent Events fan-out for the dashboard's live updates. */
export class SseHub {
  private readonly clients = new Set<Response>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(": keep-alive\n\n");
    }, 25_000);
    this.heartbeat.unref();
  }

  attach(req: Request, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
  }

  send(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
