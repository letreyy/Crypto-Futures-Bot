import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { Strategy } from '../base/strategy.js';
export declare class MomentumBreakoutStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class PumpDetectorStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class MicroPullbackStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class DumpBounceStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class RangeBounceStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
export declare class BreakoutFailureStrategy implements Strategy {
    name: string;
    id: string;
    execute(ctx: StrategyContext): StrategySignalCandidate | null;
}
