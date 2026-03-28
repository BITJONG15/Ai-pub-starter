import { ChangeDetectionStrategy, Component, signal, computed } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { MatIconModule } from '@angular/material/icon';

interface Mockup {
  name: string;
  prompt: string;
  imageUrl: string | null;
  loading: boolean;
  error: string | null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  sourceImage = signal<{ data: string; mimeType: string } | null>(null);
  sourceImageUrl = signal<string | null>(null);
  
  mockups = signal<Mockup[]>([
    { name: 'Coffee Mug', prompt: 'A high quality photo of a coffee mug with this product printed on it, sitting on a wooden table.', imageUrl: null, loading: false, error: null },
    { name: 'Billboard', prompt: 'A high quality photo of a large city billboard displaying this product advertisement.', imageUrl: null, loading: false, error: null },
    { name: 'T-Shirt', prompt: 'A high quality photo of a person wearing a t-shirt with this product printed on it.', imageUrl: null, loading: false, error: null },
    { name: 'Social Media Ad', prompt: 'A high quality Instagram post featuring this product in a lifestyle setting.', imageUrl: null, loading: false, error: null },
    { name: 'Phone Screen', prompt: 'A high quality photo of a modern smartphone held in a hand, with this product displayed on the screen.', imageUrl: null, loading: false, error: null },
    { name: 'Laptop Screen', prompt: 'A high quality photo of a sleek laptop on a desk in a modern office, with this product displayed on the screen.', imageUrl: null, loading: false, error: null },
  ]);

  isGenerating = computed(() => this.mockups().some(m => m.loading));

  async onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      this.sourceImageUrl.set(result);
      
      const base64Data = result.split(',')[1];
      this.sourceImage.set({ data: base64Data, mimeType: file.type });
      
      // Reset mockups
      this.mockups.update(mockups => mockups.map(m => ({ ...m, imageUrl: null, error: null })));
    };
    reader.readAsDataURL(file);
  }

  async generateMockups() {
    const image = this.sourceImage();
    if (!image) return;

    // Start loading for all
    this.mockups.update(mockups => mockups.map(m => ({ ...m, loading: true, error: null, imageUrl: null })));

    // Generate in parallel
    const promises = this.mockups().map((mockup, index) => this.generateSingleMockup(mockup, image, index));
    await Promise.allSettled(promises);
  }

  private async generateSingleMockup(mockup: Mockup, image: { data: string; mimeType: string }, index: number) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: image.data,
                mimeType: image.mimeType,
              },
            },
            {
              text: mockup.prompt,
            },
          ],
        },
      });

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`Generation stopped: ${candidate.finishReason}`);
      }

      let generatedImageUrl: string | null = null;
      for (const part of candidate?.content?.parts || []) {
        if (part.inlineData) {
          generatedImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (generatedImageUrl) {
        this.mockups.update(mockups => {
          const newMockups = [...mockups];
          newMockups[index] = { ...newMockups[index], imageUrl: generatedImageUrl, loading: false };
          return newMockups;
        });
      } else {
        throw new Error('The AI did not return an image. This might be due to safety filters or an internal error.');
      }
    } catch (error: unknown) {
      let errorMessage = 'An unexpected error occurred.';
      
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('safety')) {
          errorMessage = 'The request was flagged by safety filters. Try a different image or prompt.';
        } else if (message.includes('quota') || message.includes('429')) {
          errorMessage = 'API quota exceeded. Please try again later.';
        } else if (message.includes('api key')) {
          errorMessage = 'Invalid API key. Please check your configuration.';
        } else if (message.includes('network') || message.includes('fetch')) {
          errorMessage = 'Network error. Please check your internet connection.';
        } else if (message.includes('timeout')) {
          errorMessage = 'The request timed out. The server might be busy.';
        } else {
          errorMessage = error.message;
        }
      }

      console.error(`Error generating ${mockup.name}:`, error);
      this.mockups.update(mockups => {
        const newMockups = [...mockups];
        newMockups[index] = { ...newMockups[index], error: errorMessage, loading: false };
        return newMockups;
      });
    }
  }
}
