import type { Element } from "webdriverio";
import { waitUntil } from "./wait.js";
import type { Rect, WaitOptions } from "./types.js";

export class MacElement {
  constructor(
    readonly raw: Element,
    readonly description: string,
  ) {}

  async click(): Promise<void> {
    await this.raw.click();
  }

  async doubleClick(): Promise<void> {
    await this.raw.doubleClick();
  }

  async hover(): Promise<void> {
    await this.raw.moveTo();
  }

  async setValue(value: string): Promise<void> {
    await this.raw.setValue(value);
  }

  async addValue(value: string): Promise<void> {
    await this.raw.addValue(value);
  }

  async text(): Promise<string> {
    return this.raw.getText();
  }

  async attribute(name: string): Promise<string | null> {
    return this.raw.getAttribute(name);
  }

  async displayed(): Promise<boolean> {
    return this.raw.isDisplayed();
  }

  async enabled(): Promise<boolean> {
    return this.raw.isEnabled();
  }

  async rect(): Promise<Rect> {
    const rect = await this.raw.getElementRect(this.raw.elementId);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  async waitForDisplayed(options: WaitOptions = {}): Promise<void> {
    await waitUntil(() => this.displayed(), {
      ...options,
      message: options.message ?? `${this.description} was not displayed`,
    });
  }

  async waitForText(expected: string | RegExp, options: WaitOptions = {}): Promise<string> {
    return waitUntil<string>(async () => {
      const value = await this.text();
      const matches = typeof expected === "string"
        ? value.includes(expected)
        : expected.test(value);
      return matches ? value : undefined;
    }, {
      ...options,
      message: options.message ?? `${this.description} did not contain ${String(expected)}`,
    });
  }
}
