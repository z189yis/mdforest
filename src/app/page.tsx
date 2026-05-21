import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/repos");
  redirect("/login");
}
