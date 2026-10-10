import type { TiO2ConfigInput, TiO2Project } from './types.js'
export declare function createTiO2Project(rootDir: string, config: TiO2ConfigInput): TiO2Project
export declare function loadTiO2Project(rootDir: string): Promise<TiO2Project>
