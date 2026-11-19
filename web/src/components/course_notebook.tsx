import Link from 'next/link';
import { t,type Lang } from '@/lib/i18n';
import { use_course_metadata } from '@/hooks/use_course_record';
import { course_ref } from './course_cover';

export function CourseNotebook({id, hash, lang}: {id?:number; hash?:string; lang:Lang}) {
  const meta = use_course_metadata(hash).data;
  const vi = lang === 'vi';
  return <Link href={id ? `/challenges/${id}` : '/challenges'} className="notebook">
    <div className="notebook-label">
      <span className="book-edition">STUDYSTAKE <i>№ {id ? String(id).padStart(2,'0') : '—'}</i></span>
      <strong>{vi ? 'Sổ học phần' : 'Course ledger'}</strong>
      <span className="book-class">{meta ? course_ref(meta,String(id)) : t(lang,'nav_challenges')}</span>
    </div>
    <div className="notebook-open">{vi ? 'Mở hồ sơ học phần' : 'Open course record'} <b>↗</b></div>
  </Link>;
}
