import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

export const anthropic = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: 20_000, maxRetries: 1 })
  : null
