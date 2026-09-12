import Link from "next/link";
import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import BackgroundVideo from "@/components/BackgroundVideo";

export default function Home() {
  return (
    <main className="relative h-screen overflow-hidden flex flex-col">
      <BackgroundVideo />
      <Nav />
      <div className="flex-1 min-h-0">
        <Hero />
      </div>

      {/* Deliberately unlabeled and barely visible — Super Admin entry
          point. Same /login flow as everyone else; the account itself
          determines the redirect after auth. */}
      <Link
        href="/login"
        aria-label="Admin"
        className="fixed bottom-3 right-3 w-3 h-3 rounded-full opacity-[0.08] hover:opacity-40 transition-opacity bg-white z-30"
      />
    </main>
  );
}
