import { DetectFacesCommand, RekognitionClient } from "@aws-sdk/client-rekognition";
import type { NormRect } from "../domain.js";

/**
 * Finds face *locations* so they can be blurred. Never identifies anyone:
 * TrueSight only uses bounding boxes and does not call any face search or
 * face collection APIs.
 */
export interface FaceDetector {
  readonly name: string;
  detect(image: Buffer): Promise<NormRect[]>;
}

export class NoFaceDetector implements FaceDetector {
  readonly name = "none";
  async detect(): Promise<NormRect[]> {
    return [];
  }
}

export class RekognitionFaceDetector implements FaceDetector {
  readonly name = "amazon-rekognition";
  private readonly client: RekognitionClient;

  constructor(region: string) {
    this.client = new RekognitionClient({ region });
  }

  async detect(image: Buffer): Promise<NormRect[]> {
    const result = await this.client.send(new DetectFacesCommand({ Image: { Bytes: image }, Attributes: ["DEFAULT"] }));
    return (result.FaceDetails ?? [])
      .filter((face) => (face.Confidence ?? 0) >= 70 && face.BoundingBox)
      .map((face) => {
        const box = face.BoundingBox!;
        const x = Math.max(0, box.Left ?? 0);
        const y = Math.max(0, box.Top ?? 0);
        return { x, y, w: Math.min(1 - x, box.Width ?? 0), h: Math.min(1 - y, box.Height ?? 0) };
      })
      .filter((rect) => rect.w > 0 && rect.h > 0);
  }
}
