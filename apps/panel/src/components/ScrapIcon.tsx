// Иконка скрапа — та же картинка, что на карточке профиля и в эмодзи сервера.
// Без подписи рядом числу нужен alt, поэтому по умолчанию он «скрап».
export function ScrapIcon({ size, alt = "скрап" }: { size?: number; alt?: string }) {
  return (
    <img
      className="scrap-icon"
      src="/api/card/icons/scrap.png"
      alt={alt}
      title={alt || undefined}
      width={size}
      height={size}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}
