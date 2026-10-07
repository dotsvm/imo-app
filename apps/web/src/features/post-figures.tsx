import type { PostImage } from "@imo/domain/types";
import styles from "./post-figures.module.css";

/** Evidence figures on a prediction. One fills the column; two share a row. */
export function PostFigures({ images }: { images: PostImage[] }) {
  if (!images.length) return null;
  return (
    <div
      className={styles.media}
      data-count={images.length > 2 ? "many" : images.length}
    >
      {images.map((image) => (
        <figure key={image.src}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
          />
          <figcaption>{image.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}
