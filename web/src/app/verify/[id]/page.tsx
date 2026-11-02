import { VerifyView } from '@/components/verify_view';

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VerifyView id_param={id} />;
}
