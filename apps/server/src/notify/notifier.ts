import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { randomUUID } from "node:crypto";
import type { SseHub } from "./sse.js";

export interface Notification {
  id: string;
  at: string;
  level: "alert" | "resolved" | "info" | "error";
  title: string;
  body: string;
  sensorId?: string;
  evidenceId?: string;
}

/** Pushes alerts to the dashboard and, if configured, to an Amazon SNS topic (SMS / email / mobile push). */
export class Notifier {
  private readonly sns: SNSClient | null;

  constructor(
    private readonly sse: SseHub,
    private readonly topicArn: string | undefined,
    region: string,
  ) {
    this.sns = topicArn ? new SNSClient({ region }) : null;
  }

  get description(): string {
    return this.topicArn ? `dashboard + Amazon SNS (${this.topicArn})` : "dashboard";
  }

  async send(input: Omit<Notification, "id" | "at">): Promise<void> {
    const notification: Notification = { id: randomUUID(), at: new Date().toISOString(), ...input };
    this.sse.send("notification", notification);
    if (this.sns && (input.level === "alert" || input.level === "resolved")) {
      try {
        await this.sns.send(new PublishCommand({ TopicArn: this.topicArn, Subject: input.title.slice(0, 99), Message: `${input.title}\n\n${input.body}` }));
      } catch (error) {
        console.error("[notify] SNS publish failed:", (error as Error).message);
      }
    }
  }
}
