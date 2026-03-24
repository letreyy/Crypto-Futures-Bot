import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
export declare class EmaRibbonScalpStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
