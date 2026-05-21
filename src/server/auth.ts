import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Dev Login",
      credentials: {
        username: { label: "Username", type: "text" },
      },
      authorize(credentials) {
        if (!credentials?.username) return null;
        return {
          id: "dev-user",
          name: credentials.username,
          email: `${credentials.username}@dev.local`,
        };
      },
    }),
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    jwt({ token, account, user }) {
      if (account) {
        token.id = account.providerAccountId ?? user?.id ?? "dev";
        token.provider = account.provider;
      }
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
