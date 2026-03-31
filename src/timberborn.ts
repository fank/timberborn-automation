export interface Adapter {
  name: string;
  state: boolean;
}

export interface Lever {
  name: string;
  state: boolean;
  springReturn: boolean;
}

export class TimberbornClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
    this.headers = host !== "localhost" && host !== "127.0.0.1" && host !== "::1"
      ? { Host: `localhost:${port}` }
      : {};
  }

  async getAdapters(): Promise<Adapter[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/adapters`, { headers: this.headers });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async getLevers(): Promise<Lever[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/levers`, { headers: this.headers });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async switchOn(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/switch-on/${encodeURIComponent(name)}`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }

  async switchOff(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/switch-off/${encodeURIComponent(name)}`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }

  async setColor(name: string, hex: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/color/${encodeURIComponent(name)}/${hex}`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}
