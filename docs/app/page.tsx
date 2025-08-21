"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ArrowRight,
  Zap,
  GitPullRequest,
  Bot,
  Shield,
  Github,
  AlertTriangle,
  Bug,
  TrendingDown,
  Activity,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

// Mock notifications data
const mockNotifications = [
  {
    id: 1,
    service: "Sentry",
    icon: AlertTriangle,
    color: "red",
    message: "TypeError: Cannot read property 'id' of undefined",
    type: "Critical",
    location: "user-dashboard.tsx:42",
  },
  {
    id: 2,
    service: "PostHog",
    icon: TrendingDown,
    color: "orange",
    message: "Dashboard conversion rate dropped 23%",
    type: "Performance",
    location: "Last 15 minutes",
  },
  {
    id: 3,
    service: "Datadog",
    icon: Activity,
    color: "purple",
    message: "High memory usage detected on prod-server-3",
    type: "Infrastructure",
    location: "Memory: 94%",
  },
  {
    id: 4,
    service: "Bugsnag",
    icon: Bug,
    color: "yellow",
    message: "ReferenceError: validateUser is not defined",
    type: "Runtime Error",
    location: "auth-middleware.js:18",
  },
  {
    id: 5,
    service: "Sentry",
    icon: AlertTriangle,
    color: "red",
    message: "Network timeout in payment processing",
    type: "Critical",
    location: "payment-service.ts:156",
  },
  {
    id: 6,
    service: "PostHog",
    icon: TrendingDown,
    color: "orange",
    message: "User session duration decreased by 18%",
    type: "Performance",
    location: "Last 30 minutes",
  },
];

export default function SambaLandingPage() {
  const [visibleNotifications, setVisibleNotifications] = useState<
    Array<(typeof mockNotifications)[0] & { uniqueId: string }>
  >([]);
  const indexRef = useRef(0);

  useEffect(() => {
    const pushNextNotification = () => {
      const base =
        mockNotifications[indexRef.current % mockNotifications.length];
      const nextNotification = {
        ...base,
        uniqueId: `${base.id}-${Date.now()}`,
      };

      setVisibleNotifications((prev) => {
        const newNotifications = [nextNotification, ...prev].slice(0, 4);
        return newNotifications;
      });

      indexRef.current += 1;
    };

    // Seed the first alert immediately on mount
    pushNextNotification();

    const interval = setInterval(pushNextNotification, 2000); // New notification every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const getColorClasses = (color: string) => {
    const colorMap = {
      red: {
        border: "border-l-red-500",
        bg: "bg-red-500",
        badge: "bg-red-100 text-red-800",
      },
      orange: {
        border: "border-l-orange-500",
        bg: "bg-orange-500",
        badge: "bg-orange-100 text-orange-800",
      },
      purple: {
        border: "border-l-purple-500",
        bg: "bg-purple-500",
        badge: "bg-purple-100 text-purple-800",
      },
      yellow: {
        border: "border-l-yellow-500",
        bg: "bg-yellow-500",
        badge: "bg-yellow-100 text-yellow-800",
      },
    };
    return colorMap[color as keyof typeof colorMap] || colorMap.red;
  };

  return (
    <div className="min-h-screen bg-warm-off-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-deep-teal rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-deep-teal">Samba</span>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="outline" className="border-copper text-copper">
                YC AI Hackathon
              </Badge>
              <Link
                href="https://github.com/AntonioAEMartins/yc-hackathon-samba/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-deep-teal text-deep-teal hover:bg-deep-teal hover:text-white transition-colors bg-transparent"
                >
                  <Github className="w-4 h-4 mr-2" />
                  View on GitHub
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <Badge className="mb-6 bg-copper text-white hover:bg-copper-light">
            Autonomous Reactive Code-Fixer
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-charcoal mb-6 leading-tight">
            Build Once,{" "}
            <span className="text-deep-teal">Let Production Fix Itself</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            Samba listens to your production errors, finds the faulty code, and
            automatically creates pull requests with GPT-5 generated fixes. No
            more midnight debugging sessions.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/blog">
              <Button
                size="lg"
                className="bg-copper hover:bg-copper-light text-white transition-colors"
              >
                Read Blog Post
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link
              href="https://x.com/pedrostanzani/status/1955430452828983338"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="lg"
                className="border-deep-teal text-deep-teal hover:bg-deep-teal hover:text-white transition-colors bg-transparent"
              >
                Watch Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-charcoal mb-4">
              From error to prod in minutes
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Samba creates an agentic workflow that saves you from production
              errors
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-deep-teal rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-charcoal mb-2">
                Error Detection
              </h3>
              <p className="text-gray-600">
                Sentry captures production errors and sends webhooks to Samba
                with stack traces and context
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-copper rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-charcoal mb-2">
                AI Analysis
              </h3>
              <p className="text-gray-600">
                GPT-5 analyzes the error, locates the faulty code, and proposes
                the minimal safe fix
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-deep-teal-light rounded-full flex items-center justify-center mx-auto mb-4">
                <GitPullRequest className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-charcoal mb-2">
                Auto push to prod
              </h3>
              <p className="text-gray-600">
                Commits the fix to a feature branch, opens a pull request and
                merges into main
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Mock Demo Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-charcoal mb-4">
              Samba reacts to live production errors
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              See how Samba continuously monitors and responds to real-time
              alerts from your monitoring stack
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Live Error Feed */}
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-charcoal">
                  Live Production Alerts
                </h3>
              </div>

              {/* Dynamic animated feed */}
              <div className="relative h-48 perspective-1000 flex justify-center">
                <div className="relative w-full max-w-md h-64">
                  <AnimatePresence mode="popLayout">
                    {visibleNotifications.map((notification, index) => {
                      const colors = getColorClasses(notification.color);
                      const Icon = notification.icon;

                      return (
                        <motion.div
                          key={notification.uniqueId}
                          initial={{
                            y: -100,
                            scale: 1,
                            rotateX: -15,
                            opacity: 0,
                            zIndex: 50,
                          }}
                          animate={{
                            y: index * 8,
                            scale: 1 - index * 0.04,
                            rotateX: index * 1.5,
                            opacity: 1 - index * 0.2,
                            zIndex: 50 - index,
                          }}
                          exit={{
                            y: 100,
                            scale: 0.8,
                            rotateX: 15,
                            opacity: 0,
                            transition: { duration: 0.4 },
                          }}
                          transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 30,
                            duration: 0.6,
                          }}
                          className="absolute top-0 left-0 w-full"
                          style={{
                            transformStyle: "preserve-3d",
                          }}
                        >
                          <Card
                            className={`${colors.border} border-l-4 bg-white shadow-lg hover:shadow-xl transition-shadow`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start space-x-3">
                                <div
                                  className={`w-8 h-8 ${colors.bg} rounded-lg flex items-center justify-center flex-shrink-0`}
                                >
                                  <Icon className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium text-gray-900">
                                      {notification.service}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      just now
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-700 mb-2 line-clamp-2">
                                    {notification.message}
                                  </p>
                                  <div className="flex items-center space-x-2">
                                    <Badge
                                      className={`text-xs ${colors.badge}`}
                                    >
                                      {notification.type}
                                    </Badge>
                                    <span className="text-xs text-gray-500 truncate">
                                      {notification.location}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Samba Response Panel */}
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-charcoal mb-6">
                Samba's Autonomous Response
              </h3>

              <Card className="bg-deep-teal text-white py-0">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-10 h-10 bg-copper rounded-lg flex items-center justify-center">
                      <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Samba AI Agent</h4>
                      <p className="text-sm text-gray-200">
                        Processes live error stream...
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span>
                        Gets Sentry alerts and processes them in real-time
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span>Analyzes stack traces and codebase</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span>GPT-5 uses context to generate fixes</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span>Commits, opens PR and merges into prod</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* <Card className="border-l-4 border-l-green-500 bg-white">
                <CardContent className="p-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      <GitPullRequest className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">
                          GitHub PR Created
                        </span>
                        <span className="text-xs text-gray-500">just now</span>
                      </div>
                      <p className="text-sm text-gray-700 mb-2">
                        Fix: Add null check for user object in dashboard
                      </p>
                      <div className="flex items-center space-x-2">
                        <Badge className="text-xs bg-green-100 text-green-800">
                          Auto-generated
                        </Badge>
                        <span className="text-xs text-gray-500">#PR-1247</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <Shield className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-green-800">
                          ✅ Continuous error resolution active
                        </p>
                        <p className="text-xs text-green-600">
                          Average response time: 3.2 minutes
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    </div>
                  </div>
                </CardContent>
              </Card> */}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-warm-off-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-charcoal mb-4">
              What we built in only 8 hours
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="hover:shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer border-gray-200 hover:border-deep-teal/20">
              <CardContent className="p-6">
                <Zap className="w-8 h-8 text-copper mb-4 transition-colors" />
                <h3 className="text-lg font-semibold mb-2 text-charcoal">
                  Sentry Integration & Webhook
                </h3>
                <p className="text-gray-600">
                  Built a webhook system that listens to Sentry error
                  alerts and triggers our autonomous workflow in real-time
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer border-gray-200 hover:border-deep-teal/20">
              <CardContent className="p-6">
                <Bot className="w-8 h-8 text-copper mb-4 transition-colors" />
                <h3 className="text-lg font-semibold mb-2 text-charcoal">
                  Agentic Codefix Workflow
                </h3>
                <p className="text-gray-600">
                  Created an intelligent agent that plans fixes, reads and
                  understands codebases, and generates targeted solutions using
                  GPT-5
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer border-gray-200 hover:border-deep-teal/20">
              <CardContent className="p-6">
                <GitPullRequest className="w-8 h-8 text-copper mb-4 transition-colors" />
                <h3 className="text-lg font-semibold mb-2 text-charcoal">
                  GitHub Integration & PR Automation
                </h3>
                <p className="text-gray-600">
                  Seamlessly commits fixes and opens pull requests to main
                  branch with detailed descriptions and context
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer border-gray-200 hover:border-deep-teal/20">
              <CardContent className="p-6">
                <Shield className="w-8 h-8 text-copper mb-4 transition-colors" />
                <h3 className="text-lg font-semibold mb-2 text-charcoal">
                  Sandboxed Testing with <br /> Freestyle (YC S24)
                </h3>
                <p className="text-gray-600">
                  Integrated with freestyle.dev to test code changes in isolated
                  environments before creating pull requests
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-deep-teal">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Check it out!
          </h2>
          <p className="text-xl text-gray-200 mb-8 max-w-2xl mx-auto">
            Built for YC's AI Coding Agents Hackathon, Samba showcases how AI
            can autonomously fix production errors in real-time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/blog">
              <Button
                size="lg"
                className="bg-copper hover:bg-copper-light text-white transition-colors"
              >
                Read Blog Post
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link
              href="https://x.com/pedrostanzani/status/1955430452828983338"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="lg"
                className="border-white text-white hover:bg-white hover:text-deep-teal transition-colors bg-transparent"
              >
                Watch Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-charcoal py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <div className="w-8 h-8 bg-copper rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold">Samba</span>
            </div>
            <div className="flex items-center space-x-6">
              <span className="text-gray-400">
                Built for YC AI Coding Agents Hackathon
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
