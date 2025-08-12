import { ArrowLeft, Calendar, Clock } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function BlogPost() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/" className="inline-flex items-center text-deep-teal hover:text-copper transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Samba
          </Link>
        </div>
      </header>

      {/* Article */}
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Article Header */}
        <header className="mb-12">
          <div className="flex items-center gap-4 text-sm text-gray-600 mb-6">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>January 15, 2025</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>8 min read</span>
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-charcoal mb-6 leading-tight">
            Building Samba: An Autonomous AI Agent That Fixes Production Errors
          </h1>

          <p className="text-xl text-gray-600 leading-relaxed mb-8">
            How we built an AI coding agent that listens to production errors, analyzes code, and automatically creates
            pull requests with fixes — all in real-time.
          </p>

          <div className="flex items-center gap-6 mb-8">
            <div className="flex items-center gap-3">
              <img
                src="/placeholder.svg?height=48&width=48"
                alt="Antonio Martins"
                className="w-12 h-12 rounded-full object-cover"
              />
              <div>
                <div className="font-semibold text-charcoal">Antonio Martins</div>
                <div className="text-sm text-gray-600">Co-creator</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <img
                src="/placeholder.svg?height=48&width=48"
                alt="Pedro Stanzani"
                className="w-12 h-12 rounded-full object-cover"
              />
              <div>
                <div className="font-semibold text-charcoal">Pedro Stanzani</div>
                <div className="text-sm text-gray-600">Co-creator</div>
              </div>
            </div>
          </div>

          {/* Article Content */}
          <div className="prose prose-lg max-w-none">
            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">The Problem: Production Errors Never Sleep</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              Every developer knows the feeling: you're enjoying a peaceful evening when suddenly your phone buzzes with
              a Sentry alert. A critical error in production. Users are affected. The clock is ticking.
            </p>

            <p className="text-gray-700 leading-relaxed mb-6">
              Traditional workflows require developers to manually investigate errors, understand the context, write
              fixes, test them, and deploy. This process can take hours, especially for complex issues or when the
              original developer isn't available.
            </p>

            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">Enter Samba: The Autonomous Code Fixer</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              Samba is our answer to this problem. It's an AI coding agent that operates completely autonomously,
              turning production errors into pull requests without human intervention.
            </p>

            <div className="bg-gray-50 border-l-4 border-deep-teal p-6 my-8">
              <h3 className="font-semibold text-charcoal mb-2">How Samba Works:</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-700">
                <li>
                  <strong>Listen:</strong> Monitors error tracking services like Sentry, Bugsnag, and PostHog
                </li>
                <li>
                  <strong>Analyze:</strong> Uses GPT-5 to understand the error context and locate faulty code
                </li>
                <li>
                  <strong>Fix:</strong> Generates contextual code fixes based on the error and surrounding code
                </li>
                <li>
                  <strong>Deploy:</strong> Creates pull requests with detailed explanations and test suggestions
                </li>
              </ol>
            </div>

            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">Technical Architecture</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              Building Samba required integrating several complex systems:
            </p>

            <h3 className="text-xl font-semibold text-charcoal mt-8 mb-4">Error Signal Processing</h3>
            <p className="text-gray-700 leading-relaxed mb-6">
              We built webhooks that listen to multiple error tracking services. When an error occurs, Samba receives
              the full stack trace, error context, and affected user information in real-time.
            </p>

            <h3 className="text-xl font-semibold text-charcoal mt-8 mb-4">Intelligent Code Analysis</h3>
            <p className="text-gray-700 leading-relaxed mb-6">
              Using GPT-5's advanced reasoning capabilities, Samba analyzes the error alongside the relevant codebase.
              It understands not just what went wrong, but why it went wrong and how to fix it properly.
            </p>

            <h3 className="text-xl font-semibold text-charcoal mt-8 mb-4">Automated Pull Request Generation</h3>
            <p className="text-gray-700 leading-relaxed mb-6">
              Once Samba identifies a fix, it automatically creates a pull request with detailed explanations, test
              suggestions, and rollback instructions. The PR includes context about the original error and the reasoning
              behind the fix.
            </p>

            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">The Future of Autonomous Development</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              Samba represents a glimpse into the future of software development, where AI agents work alongside
              developers to maintain and improve codebases autonomously. While we built this as a hackathon project, the
              implications are profound.
            </p>

            <p className="text-gray-700 leading-relaxed mb-6">
              Imagine a world where production errors are fixed before you even know they exist. Where your codebase
              continuously improves itself. Where developers can focus on building new features instead of firefighting
              production issues.
            </p>

            <div className="bg-deep-teal text-white p-8 rounded-lg my-12">
              <h3 className="text-xl font-bold mb-4">Built for YC's AI Coding Agents Hackathon</h3>
              <p className="leading-relaxed">
                Samba was created as part of Y Combinator's AI Coding Agents Hackathon, showcasing the potential of
                autonomous AI systems in software development. While this remains a hackathon project, it demonstrates
                the exciting possibilities when AI agents are given the tools to understand, analyze, and fix code
                independently.
              </p>
            </div>

            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">Technical Challenges & Solutions</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              Building an autonomous code-fixing agent presented unique challenges:
            </p>

            <h3 className="text-xl font-semibold text-charcoal mt-8 mb-4">Context Understanding</h3>
            <p className="text-gray-700 leading-relaxed mb-6">
              The biggest challenge was helping the AI understand not just the error, but the broader context of the
              codebase. We solved this by providing GPT-5 with relevant file contents, dependency information, and
              historical error patterns.
            </p>

            <h3 className="text-xl font-semibold text-charcoal mt-8 mb-4">Safety & Reliability</h3>
            <p className="text-gray-700 leading-relaxed mb-6">
              Autonomous code changes require extreme caution. We implemented multiple safety layers, including code
              review suggestions, rollback instructions, and confidence scoring for each proposed fix.
            </p>

            <h2 className="text-2xl font-bold text-charcoal mt-12 mb-6">What's Next?</h2>

            <p className="text-gray-700 leading-relaxed mb-6">
              While Samba was built as a hackathon project, it opens up exciting possibilities for the future of
              software development. The concept of autonomous code maintenance could revolutionize how we think about
              production stability and developer productivity.
            </p>

            <p className="text-gray-700 leading-relaxed mb-6">
              We're excited to see how the community builds upon these ideas and pushes the boundaries of what's
              possible with AI coding agents.
            </p>
          </div>

          {/* Back to Home CTA */}
          <div className="mt-16 pt-8 border-t border-gray-200">
            <div className="text-center">
              <Link href="/">
                <Button size="lg" className="bg-deep-teal hover:bg-deep-teal/90 text-white">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Samba Demo
                </Button>
              </Link>
            </div>
          </div>
        </header>
      </article>
    </div>
  )
}
