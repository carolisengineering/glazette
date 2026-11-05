interface Window {
  __glazette: {
    processImage: (file: File) => Promise<{
      width: number
      height: number
      hash: string
    }>
  }
}
