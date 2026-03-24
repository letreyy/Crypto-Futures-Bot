import { SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels } from '../core/types/bot-types.js';
export declare class RiskEngine {
    static calculateLevels(ctx: StrategyContext, direction: SignalDirection): SignalLevels;
}
