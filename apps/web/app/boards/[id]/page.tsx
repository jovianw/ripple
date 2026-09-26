import { RealBoardView } from "@/components/board/RealBoardView";

export default async function BoardPage({ params }: PageProps<"/boards/[id]">) {
  const { id } = await params;
  return <RealBoardView boardId={id} />;
}
