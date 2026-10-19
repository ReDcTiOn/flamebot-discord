import { profileCommand } from "./profile.js";
import { repCommand } from "./rep.js";
import { shopCommand } from "./shop.js";
import { topCommand } from "./top.js";
import type { Command } from "./types.js";

export const commands: Command[] = [profileCommand, topCommand, repCommand, shopCommand];
