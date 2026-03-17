import {
  getThread,
  isPlaceholderThreadTitle,
  updateThread,
} from "@/lib/lmstudio/threads";

export const threadRepository = {
  getById: getThread,
  updateById: updateThread,
  isPlaceholderTitle: isPlaceholderThreadTitle,
};
