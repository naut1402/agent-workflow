import { z } from 'zod'

/**
 * Một câu hỏi blocking dạng chọn đáp án — bất biến "≥2 lựa chọn" là ràng buộc
 * duy nhất khiến `create_qa` không có nhánh free-text (coding-guideline §2.8).
 */
export const QaQuestionInput = z.object({
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(10),
})
export type QaQuestionInput = z.infer<typeof QaQuestionInput>

export const CreateQaRequest = z.object({
  questions: z.array(QaQuestionInput).min(1).max(20),
})
export type CreateQaRequest = z.infer<typeof CreateQaRequest>
