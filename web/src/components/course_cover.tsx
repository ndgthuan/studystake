import type { MetadataDoc } from '@/lib/oracle';
import type { Lang } from '@/lib/i18n';
import { phase_key } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { PhaseName } from '@/lib/contracts';

export function course_ref(meta: MetadataDoc | undefined, id: string) {
  return meta?.title.match(/\b[A-Z]{2,6}\d{3,6}\b/)?.[0] ?? (meta ? `LMS · ${meta.course_id}` : `#${id}`);
}

interface Props {
  id: string;
  meta?: MetadataDoc;
  lang: Lang;
  phase: PhaseName;
  end: number;
}

export function CourseCover({ id, meta, lang, phase, end }: Props) {
  const vi = lang === 'vi';
  const date = new Date(end * 1000);
  const locale = vi ? 'vi-VN' : 'en-GB';
  const title = meta?.title.replace(/^demo:\s*/i, '') || (vi ? `Thử thách #${id}` : `Challenge #${id}`);
  return (
    <header className="course-cover">
      <div className="cover-text">
        <div className="cover-index"><span>{course_ref(meta,id)}</span><b> / </b>{vi ? 'Hồ sơ' : 'Record'} № {id.padStart(2,'0')}</div>
        <h1>{title}</h1>
        <div className="cover-status"><span>{t(lang,phase_key(phase))}</span>{meta && <small>{meta.lms === 'demo' ? 'Demo LMS' : 'Moodle'}</small>}</div>
      </div>
      <div className="deadline-slip">
        <span>{vi ? 'Hạn cuối học phần' : 'Course deadline'}</span>
        <strong>{String(date.getDate()).padStart(2, '0')}</strong>
        <b>{date.toLocaleDateString(locale,{month:'long',year:'numeric'})}</b>
        <small>{date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})} · {vi ? 'giờ địa phương' : 'local time'}</small>
      </div>
    </header>
  );
}
