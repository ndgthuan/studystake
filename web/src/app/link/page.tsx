import { LinkForm } from '@/components/link_form';

export default async function LinkPage({ searchParams }: { searchParams: Promise<{ challenge?: string | string[] }> }) {
  const { challenge } = await searchParams;
  const return_to = typeof challenge === 'string' && /^\d{1,78}$/.test(challenge) ? `/challenges/${challenge}` : undefined;
  return <LinkForm return_to={return_to} />;
}
