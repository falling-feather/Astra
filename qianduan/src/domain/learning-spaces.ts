import manifest from 'virtual:astra-spaces';
import type { LearningSpaceView } from './models';
import type { LearningSpaceRead } from '../portal/api-v2.generated';

export type LearningSpace = Omit<LearningSpaceRead, 'view'> & {
  view: LearningSpaceView;
};

export const learningSpaces: readonly LearningSpace[] = manifest.spaces;
export const learningLevels = manifest.levels;
export const spaceForView = (view: string): LearningSpace | undefined =>
  learningSpaces.find((space) => space.view === view);
