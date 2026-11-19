import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { use_course_metadata } from '@/hooks/use_course_record';
import { course_ref } from './course_cover';
import type { NotebookArt, NotebookScene } from './notebook_scene';

export function CourseNotebook({ id, hash, lang }: { id?: number; hash?: string; lang: Lang }) {
  const meta = use_course_metadata(hash).data;
  const vi = lang === 'vi';
  const edition = id ? String(id).padStart(2, '0') : '—';
  const title = vi ? 'Sổ học phần' : 'Course ledger';
  const course = meta ? course_ref(meta, String(id)) : t(lang, 'nav_challenges');
  const action = vi ? 'Mở hồ sơ học phần' : 'Open course record';
  const stage = useRef<HTMLAnchorElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<NotebookScene | null>(null);
  const art = useRef<NotebookArt>({ edition, title, course, action });

  useEffect(() => {
    art.current = { edition, title, course, action };
    scene.current?.update(art.current);
  }, [edition, title, course, action]);

  useEffect(() => {
    const link = stage.current;
    const surface = canvas.current;
    if (!link || !surface) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = true;
    let loading = false;
    let visible = false;

    async function load() {
      if (!visible || reduced.matches || scene.current || loading) return;
      loading = true;
      try {
        const { createNotebookScene } = await import('./notebook_scene');
        if (active && !reduced.matches && visible && link && surface) {
          scene.current = createNotebookScene(link, surface, art.current);
        }
      } catch {
        // The HTML cover is already visible if the graphics chunk or renderer fails.
      } finally {
        loading = false;
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) void load();
    });
    const syncPreference = () => {
      if (reduced.matches) {
        scene.current?.dispose();
        scene.current = null;
      } else {
        void load();
      }
    };

    observer.observe(link);
    reduced.addEventListener('change', syncPreference);
    return () => {
      active = false;
      observer.disconnect();
      reduced.removeEventListener('change', syncPreference);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  return (
    <Link href={id ? `/challenges/${id}` : '/challenges'} className="notebook" ref={stage}>
      <div className="notebook-cover">
        <div className="notebook-label">
          <span className="book-edition">STUDYSTAKE <i>№ {edition}</i></span>
          <strong>{title}</strong>
          <span className="book-class">{course}</span>
        </div>
        <div className="notebook-open">{action} <b>↗</b></div>
      </div>
      <canvas className="notebook-canvas" aria-hidden="true" ref={canvas} />
    </Link>
  );
}
