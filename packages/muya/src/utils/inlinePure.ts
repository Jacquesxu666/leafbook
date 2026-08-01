export interface IUnion {
    start: number;
    end: number;
    active?: boolean;
}

export function isLengthEven(str = ''): boolean {
    return str.length % 2 === 0;
}

export function union<TLight extends IUnion>(
    { start: targetStart, end: targetEnd }: IUnion,
    { start: lightStart, end: lightEnd, active }: TLight,
): { start: number; end: number; active: TLight['active'] } | null {
    if (targetEnd <= lightStart || lightEnd <= targetStart)
        return null;
    return {
        start: Math.max(targetStart, lightStart),
        end: Math.min(targetEnd, lightEnd),
        active,
    };
}
