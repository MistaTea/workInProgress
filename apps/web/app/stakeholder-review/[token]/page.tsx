import { StakeholderReviewPage } from "./stakeholder-review-page";

interface PageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function ReviewTokenPage({ params }: PageProps) {
  const { token } = await params;

  return <StakeholderReviewPage token={token} />;
}
