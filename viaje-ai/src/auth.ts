import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { ensureUserDocument } from "@/lib/firebaseAdmin";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user?.email) {
        await ensureUserDocument({
          uid: user.id ?? user.email,
          email: user.email,
          displayName: user.name,
          photoURL: user.image,
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        const nextUserId = user.id ?? token.sub ?? user.email ?? undefined;
        if (nextUserId) token.id = nextUserId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const nextSessionId = token.id ?? token.sub ?? session.user.email ?? undefined;
        if (nextSessionId) session.user.id = nextSessionId;
      }
      return session;
    },
  },
};

export const auth = NextAuth(authOptions);