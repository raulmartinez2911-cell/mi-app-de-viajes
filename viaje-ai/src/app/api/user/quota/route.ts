import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getUserDailyQuota } from "@/lib/firebaseAdmin";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email;
  const quota = await getUserDailyQuota(userId);

  return NextResponse.json(quota);
}
