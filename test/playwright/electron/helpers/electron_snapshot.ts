import { expect } from '@playwright/test';

/**
 * Compare pixel snapshots for both Linux viewport projects when the Linux
 * visual owner enables them. The PR workflow enables this for Linux and
 * disables it for macOS/Windows; release runs keep the screenshots as
 * artifacts without using them as a comparison gate. The Docker image uses
 * the same Linux-wide/narrow owner for local reproduction and regeneration.
 */
export function expectLinuxSnapshot(screenshot: Buffer, snapshotName: string): void {
  if (process.env.PLAYWRIGHT_VISUAL_SNAPSHOTS !== 'true' || process.platform !== 'linux') {
    return;
  }

  expect(screenshot).toMatchSnapshot(snapshotName, { maxDiffPixelRatio: 0.05 });
}
