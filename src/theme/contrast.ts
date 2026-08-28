export const withAlpha = (color: string, alpha: number) => {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  return `#${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;
};

export const mix = (base: string, _overlay: string, _amount: number) => base;
export const readableOn = (_color: string) => '#ffffff';
