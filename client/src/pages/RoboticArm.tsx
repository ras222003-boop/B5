/*
 * Design: Warm Contemporary
 * Robotic Arm page - Shows arm features with DISCONNECTED status
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Wifi,
  WifiOff,
  Settings,
  Pen,
  Gauge,
  Ruler,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import Layout from "@/components/Layout";
import SectionHeading from "@/components/SectionHeading";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { roboticArmMessages } from "@/i18n/locales/roboticArm";
import { toast } from "sonner";

const roboticArmImage = "https://d2xsxph8kpxj0f.cloudfront.net/310519663660690446/egP6Ccw5DpGVLQ8nQQhPRc/robotic-arm-btZRLCutmPSqx3AVedUpMr.webp";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export default function RoboticArm() {
  const t = useMessages(roboticArmMessages);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const handleConnect = () => {
    setStatus("connecting");
    // Simulate connection attempt then fail (arm not connected)
    setTimeout(() => {
      setStatus("disconnected");
      toast.error(t.connect.errorTitle, {
        description: t.connect.errorDescription,
      });
    }, 3000);
  };

  const statusConfig = {
    disconnected: {
      icon: WifiOff,
      label: t.status.disconnected.label,
      description: t.status.disconnected.description,
      color: "text-red-500",
      bg: "bg-red-50",
      border: "border-red-200",
      dot: "bg-red-500",
    },
    connecting: {
      icon: Loader2,
      label: t.status.connecting.label,
      description: t.status.connecting.description,
      color: "text-amber-500",
      bg: "bg-amber-50",
      border: "border-amber-200",
      dot: "bg-amber-500",
    },
    connected: {
      icon: Wifi,
      label: t.status.connected.label,
      description: t.status.connected.description,
      color: "text-green-500",
      bg: "bg-green-50",
      border: "border-green-200",
      dot: "bg-green-500",
    },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  return (
    <Layout>
      {/* Hero */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-amber-50/50 to-background">
        <div className="container">
          <SectionHeading
            badge={t.hero.badge}
            title={t.hero.title}
            description={t.hero.description}
          />
        </div>
      </section>

      {/* Connection Status Panel */}
      <section className="py-8">
        <div className="container max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className={`p-6 md:p-8 rounded-2xl border-2 ${currentStatus.border} ${currentStatus.bg}`}
          >
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <StatusIcon className={`w-8 h-8 ${currentStatus.color} ${status === "connecting" ? "animate-spin" : ""}`} />
                  <div className={`absolute -top-1 -start-1 w-3 h-3 rounded-full ${currentStatus.dot} ${status === "disconnected" ? "" : "animate-pulse"}`} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{currentStatus.label}</h3>
                  <p className="text-sm text-muted-foreground">{currentStatus.description}</p>
                </div>
              </div>
              <Button
                onClick={handleConnect}
                disabled={status === "connecting"}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl active:scale-[0.97] transition-all"
              >
                {status === "connecting" ? (
                  <>
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {t.connect.connecting}
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4 me-2" />
                    {t.connect.button}
                  </>
                )}
              </Button>
            </div>

            {status === "disconnected" && (
              <div className="mt-4 p-4 rounded-xl bg-white/60 border border-red-100 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">{t.instructions.title}</p>
                  <ol className="list-decimal list-inside space-y-1">
                    {t.instructions.items.map(item => <li key={item}>{item}</li>)}
                  </ol>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </section>

      {/* Arm Image & Description */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <img
                src={roboticArmImage}
                alt={t.workflow.imageAlt}
                className="rounded-2xl shadow-xl w-full"
                loading="lazy"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-6">{t.workflow.title}</h3>
              <div className="space-y-6">
                {t.workflow.steps.map((item, i) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <span className="text-amber-700 font-bold">{i + 1}</span>
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">{item.title}</h4>
                      <p className="text-muted-foreground text-sm">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Arm Controls */}
      <section className="py-16 md:py-24 bg-amber-50/30">
        <div className="container">
          <SectionHeading
            badge={t.controls.badge}
            title={t.controls.title}
            description={t.controls.description}
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {t.controls.items.map((item, i) => {
              const icons = [Gauge, Pen, MapPin, Settings];
              const Icon = icons[i];
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="text-center p-6 rounded-2xl bg-card border border-border/50"
                >
                  <div className="w-14 h-14 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <Icon className="w-7 h-7 text-amber-600" />
                  </div>
                  <h4 className="font-bold mb-1">{item.title}</h4>
                  <p className="text-muted-foreground text-xs">{item.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    </Layout>
  );
}
