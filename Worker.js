import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        online: true,
        name: "Lingo Game Server",
        game: "Two Player",
        websocket: true
      });
    }

    if (url.pathname === "/match") {
      const id = env.GAME_ROOMS.idFromName("public-room");
      const room = env.GAME_ROOMS.get(id);
      return room.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const players = this.ctx.getWebSockets();

    if (players.length >= 2) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "waiting",
      message: "منتظر بازیکن دوم هستیم..."
    }));

    const currentPlayers = this.ctx.getWebSockets();

    if (currentPlayers.length === 2) {
      for (const player of currentPlayers) {
        player.send(JSON.stringify({
          type: "game_start",
          message: "حریف پیدا شد! بازی شروع شد."
        }));
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws, message) {
    for (const player of this.ctx.getWebSockets()) {
      if (player !== ws) {
        player.send(message);
      }
    }
  }

  async webSocketClose(ws) {
    for (const player of this.ctx.getWebSockets()) {
      if (player !== ws) {
        player.send(JSON.stringify({
          type: "opponent_left",
          message: "حریف از بازی خارج شد."
        }));
      }
    }
  }
}
