import NextAuth, { type NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
  providers: [{
    id: "google",
    name: "Google",
    type: "oauth",
    wellKnown: "https://accounts.google.com/.well-known/openid-configuration",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorization: { params: { scope: "openid email profile" } },
    profile(profile) {
      return { id: profile.sub, name: profile.name, email: profile.email, image: profile.picture };
    },
  }],
  session: { strategy: "jwt" },
};

export const auth = NextAuth(authOptions);