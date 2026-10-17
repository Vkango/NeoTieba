// 与 dropin 项目一致的动效常量（spring 参数保持一致），供全局复用。
export const APPLE_SPRING = {
    type: 'spring',
    stiffness: 260,
    damping: 28,
    mass: 0.8
} as const;

export const MICRO_SPRING = {
    type: 'spring',
    stiffness: 500,
    damping: 35,
    mass: 0.5
} as const;

export const SOFT_SPRING = {
    type: 'spring',
    stiffness: 220,
    damping: 30,
    mass: 0.9
} as const;

export const INSTANT_MOTION = {
    type: 'keyframes',
    duration: 0
} as const;
