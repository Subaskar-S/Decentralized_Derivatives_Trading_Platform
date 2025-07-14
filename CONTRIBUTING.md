# 🤝 Contributing to Derivatives DAO Platform

Thank you for your interest in contributing to the Derivatives DAO Platform! This document provides detailed guidelines for contributing to this project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contribution Workflow](#contribution-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Security Considerations](#security-considerations)
- [Documentation](#documentation)
- [Review Process](#review-process)

## 📜 Code of Conduct

This project adheres to a code of conduct that we expect all contributors to follow:

- **Be respectful**: Treat everyone with respect and kindness
- **Be inclusive**: Welcome newcomers and help them get started
- **Be collaborative**: Work together to build something amazing
- **Be professional**: Maintain high standards in all interactions

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js 18+** installed
- **Git** for version control
- **Basic knowledge** of Solidity, React, and GraphQL
- **Understanding** of DeFi concepts and derivatives trading

### First-Time Contributors

1. **Explore the codebase**: Familiarize yourself with the project structure
2. **Read the documentation**: Check out all README files and docs
3. **Run the project locally**: Follow the setup instructions
4. **Look for "good first issue" labels**: Start with beginner-friendly tasks

## 🛠️ Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub
gh repo fork Subaskar-S/derivatives-dao-platform

# Clone your fork
git clone https://github.com/YOUR_USERNAME/derivatives-dao-platform.git
cd derivatives-dao-platform
```

### 2. Install Dependencies

```bash
# Root dependencies
npm install

# Frontend dependencies
cd frontend && npm install && cd ..

# API dependencies
cd api && npm install && cd ..

# Subgraph dependencies
cd graph && npm install && cd ..
```

### 3. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit with your configuration
# Add your Infura/Alchemy keys, private keys, etc.
```

### 4. Start Development Environment

```bash
# Terminal 1: Start local blockchain
npx hardhat node

# Terminal 2: Deploy contracts
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3: Start subgraph
cd graph && npm run create-local && npm run deploy-local

# Terminal 4: Start API server
cd api && npm run dev

# Terminal 5: Start frontend
cd frontend && npm start
```

## 🔄 Contribution Workflow

### 1. Create Feature Branch

```bash
# Create and switch to feature branch
git checkout -b feature/add-stop-loss-orders

# For bug fixes
git checkout -b fix/liquidation-calculation-bug

# For documentation
git checkout -b docs/update-api-reference
```

### 2. Make Changes

- **Write clean code**: Follow existing patterns and conventions
- **Add tests**: Include unit tests for new functionality
- **Update docs**: Keep documentation current
- **Consider security**: Review security implications

### 3. Commit Changes

Use descriptive commit messages following this format:

```bash
git commit -m "Add stop-loss order functionality

- Implement stop-loss order creation and management
- Add price monitoring for automatic execution
- Include comprehensive tests for edge cases
- Update API documentation with new endpoints

Closes #123"
```

### 4. Push and Create PR

```bash
# Push to your fork
git push origin feature/add-stop-loss-orders

# Create pull request
gh pr create --title "Add stop-loss order functionality" \
  --body "Detailed description of changes and testing performed"
```

## 📝 Coding Standards

### Smart Contracts (Solidity)

```solidity
// Use clear, descriptive names
contract DerivativesEngine {
    // State variables with visibility
    mapping(bytes32 => Position) public positions;
    
    // Events with indexed parameters
    event PositionOpened(
        indexed address trader,
        indexed bytes32 positionId,
        string symbol,
        uint256 size,
        uint256 collateral,
        bool isLong
    );
    
    // Functions with proper documentation
    /**
     * @notice Opens a new trading position
     * @param symbol The trading pair symbol
     * @param size Position size in USD
     * @param collateral Collateral amount
     * @param isLong True for long, false for short
     * @return positionId The unique position identifier
     */
    function openPosition(
        string memory symbol,
        uint256 size,
        uint256 collateral,
        bool isLong
    ) external returns (bytes32 positionId) {
        // Implementation
    }
}
```

### Frontend (React/TypeScript)

```typescript
// Use TypeScript interfaces
interface Position {
  id: string;
  trader: string;
  symbol: string;
  size: BigNumber;
  collateral: BigNumber;
  isLong: boolean;
}

// Custom hooks for reusable logic
const usePositions = (trader: string) => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Implementation
  
  return { positions, loading, refetch };
};

// Component with proper error handling
const PositionCard: React.FC<{ position: Position }> = ({ position }) => {
  const { closePosition, loading } = useClosePosition();
  
  const handleClose = async () => {
    try {
      await closePosition(position.id);
    } catch (error) {
      console.error('Failed to close position:', error);
      // Show user-friendly error message
    }
  };
  
  return (
    <Card>
      {/* Component JSX */}
    </Card>
  );
};
```

### Backend (GraphQL/Node.js)

```typescript
// Resolver with proper error handling
const resolvers = {
  Query: {
    positions: async (
      parent: any,
      { trader, first, skip }: PositionsArgs,
      { dataSources, user }: Context
    ) => {
      try {
        // Validate input
        if (!trader || !isValidAddress(trader)) {
          throw new UserInputError('Invalid trader address');
        }
        
        // Fetch data
        const positions = await dataSources.subgraphAPI.getPositions({
          trader,
          first: Math.min(first || 10, 100), // Limit max results
          skip: skip || 0,
        });
        
        return positions;
      } catch (error) {
        logger.error('Error fetching positions:', error);
        throw error;
      }
    },
  },
};
```

## 🧪 Testing Guidelines

### Unit Tests

```javascript
describe('DerivativesEngine', () => {
  it('should open position with correct parameters', async () => {
    const { derivativesEngine, trader1 } = await loadFixture(deployFixture);
    
    const tx = await derivativesEngine.connect(trader1).openPosition(
      'ETH/USD',
      ethers.parseEther('10000'),
      ethers.parseEther('1000'),
      true,
      50
    );
    
    await expect(tx)
      .to.emit(derivativesEngine, 'PositionOpened')
      .withArgs(trader1.address, anyValue, 'ETH/USD', anyValue, anyValue, true);
  });
});
```

### Security Tests

```javascript
describe('Security Tests', () => {
  it('should prevent reentrancy attacks', async () => {
    const { derivativesEngine, maliciousContract } = await loadFixture(securityFixture);
    
    await expect(
      maliciousContract.attemptReentrancy(derivativesEngine.target)
    ).to.be.revertedWith('ReentrancyGuard: reentrant call');
  });
});
```

### Integration Tests

```javascript
describe('End-to-End Trading Flow', () => {
  it('should complete full trading cycle', async () => {
    // 1. Open position
    // 2. Add collateral
    // 3. Update price
    // 4. Close position
    // 5. Verify final state
  });
});
```

## 🔒 Security Considerations

### Smart Contract Security

- **Access Control**: Use OpenZeppelin's access control patterns
- **Reentrancy Protection**: Apply ReentrancyGuard to state-changing functions
- **Integer Overflow**: Use Solidity 0.8+ built-in overflow protection
- **Input Validation**: Validate all user inputs and external data

### Frontend Security

- **Input Sanitization**: Sanitize all user inputs
- **XSS Prevention**: Use React's built-in XSS protection
- **Secure Storage**: Never store private keys in localStorage
- **HTTPS Only**: Ensure all API calls use HTTPS

### API Security

- **Rate Limiting**: Implement rate limiting for all endpoints
- **Input Validation**: Validate and sanitize all inputs
- **Error Handling**: Don't expose sensitive information in errors
- **Authentication**: Implement proper authentication where needed

## 📚 Documentation

### Code Documentation

- **Inline Comments**: Explain complex logic and business rules
- **Function Documentation**: Use JSDoc/NatSpec for all public functions
- **README Updates**: Keep README files current with changes
- **API Documentation**: Update GraphQL schema documentation

### Example Documentation

```solidity
/**
 * @title DerivativesEngine
 * @notice Core contract for managing derivative trading positions
 * @dev Implements perpetual futures with funding rate mechanism
 * @author Subaskar_S
 */
contract DerivativesEngine {
    /**
     * @notice Calculates the liquidation price for a position
     * @dev Uses maintenance margin and current market conditions
     * @param positionId The unique identifier for the position
     * @return liquidationPrice The price at which position gets liquidated
     */
    function calculateLiquidationPrice(bytes32 positionId) 
        external 
        view 
        returns (uint256 liquidationPrice) 
    {
        // Implementation with detailed comments
    }
}
```

## 🔍 Review Process

### Pull Request Requirements

1. **Descriptive Title**: Clear, concise description of changes
2. **Detailed Description**: Explain what, why, and how
3. **Testing**: Include test results and coverage information
4. **Documentation**: Update relevant documentation
5. **Security Review**: Consider security implications

### Review Checklist

- [ ] Code follows project conventions
- [ ] All tests pass
- [ ] Security considerations addressed
- [ ] Documentation updated
- [ ] No breaking changes (or properly documented)
- [ ] Gas optimization considered (for smart contracts)
- [ ] Error handling implemented
- [ ] Edge cases covered

### Reviewer Guidelines

- **Be constructive**: Provide helpful feedback
- **Be thorough**: Review code, tests, and documentation
- **Be timely**: Respond to PRs within 48 hours
- **Be educational**: Explain reasoning behind suggestions

## 🎯 Types of Contributions

### 🐛 Bug Fixes
- Fix existing issues
- Improve error handling
- Resolve edge cases

### ✨ New Features
- Add new trading features
- Implement user requests
- Enhance existing functionality

### 📚 Documentation
- Improve README files
- Add code examples
- Create tutorials

### 🔒 Security
- Fix vulnerabilities
- Add security tests
- Improve access controls

### ⚡ Performance
- Optimize gas usage
- Improve query performance
- Reduce bundle size

### 🧪 Testing
- Add test coverage
- Improve test quality
- Add integration tests

## 📞 Getting Help

- **Discord**: Join our development channel
- **GitHub Issues**: Ask questions or report bugs
- **Documentation**: Check existing docs first
- **Code Review**: Learn from PR feedback

## 🙏 Recognition

Contributors will be recognized in:
- Project README
- Release notes
- Hall of fame
- Special contributor badges

---

**Thank you for contributing to the future of decentralized finance! 🚀**
