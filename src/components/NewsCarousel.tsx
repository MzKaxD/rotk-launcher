import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, MoveUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PublishedUpdate } from "../../shared/contracts";
import type { AppLocale } from "../../shared/locale";
import { useI18n } from "../i18n";

interface NewsCarouselProps {
  updates: PublishedUpdate[];
}

const FALLBACK_UPDATE: PublishedUpdate = {
  id: "offline",
  type: "dev",
  title: "RETURN OF THE KING",
  summary: "",
  version: null,
  category: "DEVELOPMENT",
  coverImageUrl: "",
  publishedAt: new Date(0).toISOString(),
  siteUrl: "https://rotk.app/updates",
};

function formattedDate(value: string, locale: AppLocale, fallbackLabel: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return `ROTK / ${fallbackLabel}`;
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  return new Intl.DateTimeFormat(dateLocale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date).toLocaleUpperCase(dateLocale);
}

export function NewsCarousel({ updates }: NewsCarouselProps) {
  const { locale, copy } = useI18n();
  const fallback = useMemo<PublishedUpdate>(
    () => ({ ...FALLBACK_UPDATE, summary: copy.news.fallbackSummary, category: copy.news.fallbackCategory }),
    [copy.news.fallbackCategory, copy.news.fallbackSummary],
  );
  const slides = useMemo(() => (updates.length > 0 ? updates.slice(0, 2) : [fallback]), [fallback, updates]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const active = slides[activeIndex % slides.length];

  useEffect(() => {
    if (slides.length < 2 || paused || reduceMotion) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % slides.length), 7_500);
    return () => window.clearInterval(timer);
  }, [paused, reduceMotion, slides.length]);

  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(0);
  }, [activeIndex, slides.length]);

  const move = (direction: number) => {
    setActiveIndex((index) => (index + direction + slides.length) % slides.length);
  };

  const openActive = () => {
    const path = active.id === "offline" ? "/updates" : `/updates/${encodeURIComponent(active.id)}`;
    void window.rotk.openWebsite(path);
  };

  return (
    <section
      className="news-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-label={copy.news.label}
    >
      <div className="news-carousel__visual" aria-hidden="true">
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={`${active.id}-background`}
            className="news-carousel__image-layer"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.035 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            {active.coverImageUrl && <img src={active.coverImageUrl} alt="" draggable={false} />}
          </motion.div>
        </AnimatePresence>
        <div className="news-carousel__shade" />
        <div className="news-carousel__grain" />
      </div>

      <div className="news-carousel__rail" aria-label={copy.news.navigation}>
        <span className="news-carousel__count">
          {String(activeIndex + 1).padStart(2, "0")} <i>/</i> {String(slides.length).padStart(2, "0")}
        </span>
        <div className="news-carousel__dots">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              aria-label={copy.news.showItem(index + 1)}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.article
          key={active.id}
          className="news-carousel__content"
          initial={{ opacity: 0, y: reduceMotion ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }}
          transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="news-carousel__meta">
            <span>{active.type === "patch" ? copy.news.patchNote : copy.news.devUpdate}</span>
            <i />
            <span>{active.version ? `${copy.news.version} ${active.version}` : formattedDate(active.publishedAt, locale, copy.news.fallbackCategory)}</span>
          </div>
          <h1>{active.title}</h1>
          <p>{active.summary}</p>
          <button type="button" className="editorial-link" onClick={openActive}>
            {copy.news.readUpdate} <MoveUpRight size={16} />
          </button>
        </motion.article>
      </AnimatePresence>

      {slides.length > 1 && (
        <div className="news-carousel__arrows">
          <button type="button" aria-label={copy.news.previous} onClick={() => move(-1)}>
            <ArrowLeft size={20} />
          </button>
          <button type="button" aria-label={copy.news.next} onClick={() => move(1)}>
            <ArrowRight size={20} />
          </button>
        </div>
      )}
    </section>
  );
}
