import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El indicador de desarrollo de Next.js (la esquina inferior izquierda) se
  // traslapa exactamente con el botón "Lista" de la barra de navegación en
  // localhost — bloquea el click. Apaga solo el indicador; no afecta producción.
  devIndicators: false,
  async headers() {
    return [
      {
        // El service worker no debe quedarse cacheado con versiones viejas
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
