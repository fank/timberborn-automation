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

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async getAdapters(): Promise<Adapter[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/adapters`);
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async getLevers(): Promise<Lever[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/levers`);
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async switchOn(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/switch-on/${encodeURIComponent(name)}`);
      return res.ok;
    } catch { return false; }
  }

  async switchOff(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/switch-off/${encodeURIComponent(name)}`);
      return res.ok;
    } catch { return false; }
  }

  async setColor(name: string, hex: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/color/${encodeURIComponent(name)}/${hex}`);
      return res.ok;
    } catch { return false; }
  }
}
