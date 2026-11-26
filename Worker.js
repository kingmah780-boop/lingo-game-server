
import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        online: true,
        name: "Lingo Game Server",
        game: "Two Player",
        version: "2.1"
      });
    }

    if (url.pathname === "/match") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

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
    this.scores = [0, 0];
  }

  async fetch(request) {
    const players = this.ctx.getWebSockets();
    const occupiedSlots = new Set();

    for (const player of players) {
      const attachment = player.deserializeAttachment();

      if (attachment && Number.isInteger(attachment.player)) {
        occupiedSlots.add(attachment.player);
      }
    }

    let playerSlot = 0;

    while (occupiedSlots.has(playerSlot) && playerSlot < 2) {
      playerSlot++;
    }

    if (playerSlot >= 2) {
      return new Response("Room is full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      player: playerSlot
    });

    server.send(JSON.stringify({
      type: "waiting",
      message: "منتظر بازیکن دوم هستیم..."
    }));

    const currentPlayers = this.ctx.getWebSockets();

    if (currentPlayers.length === 2) {
      for (const player of currentPlayers) {
        player.send(JSON.stringify({
          type: "game_start",
          message: "حریف پیدا شد!"
        }));
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      if (typeof message !== "string") {
        throw new Error("Text message required");
      }

      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({
        type: "error",
        message: "پیام نامعتبر است"
      }));
      return;
    }

    if (!data || typeof data !== "object") {
      ws.send(JSON.stringify({
        type: "error",
        message: "ساختار پیام نامعتبر است"
      }));
      return;
    }

    const attachment = ws.deserializeAttachment();
    const players = this.ctx.getWebSockets();

    if (
      !attachment ||
      !Number.isInteger(attachment.player) ||
      attachment.player < 0 ||
      attachment.player > 1 ||
      !players.includes(ws)
    ) {
      return;
    }

    if (data.type === "score") {
      const score = Number(data.score);

      if (
        !Number.isInteger(score) ||
        score < 0 ||
        score > 1000
      ) {
        ws.send(JSON.stringify({
          type: "error",
          message: "امتیاز نامعتبر است"
        }));
        return;
      }

      this.scores[attachment.player] = score;

      for (const player of players) {
        player.send(JSON.stringify({
          type: "score_update",
          scores: this.scores
        }));
      }

      return;
    }

    if (data.type === "finish") {
      for (const player of players) {
        player.send(JSON.stringify({
          type: "game_finished",
          scores: this.scores
        }));
      }

      return;
    }

    for (const player of players) {
      if (player !== ws) {
        player.send(JSON.stringify({
          type: "message",
          data
        }));
      }
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();

    if (
      attachment &&
      Number.isInteger(attachment.player) &&
      attachment.player >= 0 &&
      attachment.player <= 1
    ) {
      this.scores[attachment.player] = 0;
    }

    const remainingPlayers = this.ctx.getWebSockets();

    for (const player of remainingPlayers) {
      player.send(JSON.stringify({
        type: "opponent_left",
        message: "حریف از بازی خارج شد."
      }));
    }

    if (remainingPlayers.length === 0) {
      this.scores = [0, 0];
    }
  }
}
