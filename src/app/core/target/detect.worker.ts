/// <reference lib="webworker" />
import cvModule from '@techstark/opencv-js';
import { DetectRequest, detectTarget, openCvReady } from './detect';

const ready = openCvReady(cvModule);

addEventListener(
  'message',
  async ({ data }: MessageEvent<{ id: number; request: DetectRequest }>) => {
    try {
      const { cv } = await ready;
      const result = detectTarget(cv, data.request);
      const transfer = 'flat' in result && result.flat ? [result.flat.data.buffer] : [];
      postMessage({ id: data.id, result }, transfer as Transferable[]);
    } catch (error) {
      postMessage({ id: data.id, error: String(error) });
    }
  },
);
