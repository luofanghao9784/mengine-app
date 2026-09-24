import type { DemoState, Material } from '../model.ts';
import { canReadMaterial } from '../libraryModel.ts';

export interface MaterialReadModel {
  listVisible(): Material[];
  findVisible(id: string | undefined): Material | undefined;
}

/** Demo projection only. Server authorization and async material API arrive in M2-C1. */
export function createDemoMaterialReadModel(getState: () => DemoState): MaterialReadModel {
  return {
    listVisible() {
      const state = getState();
      return state.materials.filter((material) => canReadMaterial(state, material));
    },
    findVisible(id) {
      const state = getState();
      return state.materials.find((material) => material.id === id && canReadMaterial(state, material));
    },
  };
}
