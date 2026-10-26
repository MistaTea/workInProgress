import { HomeWorkbench } from "./home-workbench";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <HomeWorkbench
      initialProjectId={
        typeof params.projectId === "string"
          ? params.projectId
          : params.projectId
            ? "invalid-project-selection"
            : ""
      }
    />
  );
}
