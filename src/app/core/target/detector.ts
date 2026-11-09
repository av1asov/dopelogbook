import { Injectable } from '@angular/core';
import {
  DetectImage,
  DetectRequest,
  DetectResult,
  FlatImage,
  MeasureRequest,
  MeasureResult,
  SurveyRequest,
  SurveyResult,
  WarpRequest,
  WarpResult,
} from './detect';

interface Pending {
  resolve: (result: DetectResult) => void;
  reject: (reason: unknown) => void;
}

/** Runs recognition in a worker, so that OpenCV starts only when it is first needed. */
@Injectable({ providedIn: 'root' })
export class TargetDetector {
  private worker: Worker | null = null;
  private lastId = 0;
  private readonly pending = new Map<number, Pending>();

  measure(request: MeasureRequest): Promise<MeasureResult> {
    return this.run(request) as Promise<MeasureResult>;
  }

  survey(request: SurveyRequest): Promise<SurveyResult> {
    return this.run(request) as Promise<SurveyResult>;
  }

  warp(request: WarpRequest): Promise<WarpResult> {
    return this.run(request) as Promise<WarpResult>;
  }

  private run(request: DetectRequest): Promise<DetectResult> {
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.start().postMessage({ id, request }, [request.image.data.buffer]);
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./detect.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) pending?.reject(new Error(data.error));
      else pending?.resolve(data.result);
    };
    // Typically the script could not be fetched: offline, before it was ever cached.
    worker.onerror = (event) => {
      this.worker = null;
      for (const { reject } of this.pending.values()) reject(new Error(event.message));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }
}

/** The pixels of a photo, ready to hand over to the worker. */
export async function readPixels(blob: Blob): Promise<DetectImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas is unavailable');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** The rectified picture as an address an image can show. */
export async function flatUrl({ data, width, height }: FlatImage): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new ImageData(new Uint8ClampedArray(data), width, height);
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) throw new Error('could not encode the rectified photo');
  return URL.createObjectURL(blob);
}
